(function () {
    'use strict';

    angular.module('ariaNg').controller('AriaNgDebugController', ['$rootScope', '$scope', '$location', '$interval', '$timeout', '$filter', 'ariaNgConstants', 'ariaNgCommonService', 'ariaNgLocalizationService', 'ariaNgLogService', 'ariaNgKeyboardService', 'ariaNgSettingService', 'aria2RpcService', function ($rootScope, $scope, $location, $interval, $timeout, $filter, ariaNgConstants, ariaNgCommonService, ariaNgLocalizationService, ariaNgLogService, ariaNgKeyboardService, ariaNgSettingService, aria2RpcService) {
        var tabStatusItems = [
            {
                name: 'logs',
                show: true
            },
            {
                name: 'rpc',
                show: true
            }
        ];
        var debugLogRefreshPromise = null;

        var getVisibleTabOrders = function () {
            var items = [];

            for (var i = 0; i < tabStatusItems.length; i++) {
                if (tabStatusItems[i].show) {
                    items.push(tabStatusItems[i].name);
                }
            }

            return items;
        };

        var getAria2RPCMethods = function () {
            var rpcMethods = [];

            for (var field in aria2RpcService) {
                if (!aria2RpcService.hasOwnProperty(field) || !angular.isFunction(aria2RpcService[field])) {
                    continue;
                }

                var func = aria2RpcService[field];
                var funcCode = func.toString();

                if (funcCode.indexOf('return invoke(') < 0) {
                    continue;
                }

                try {
                    var requestContext = aria2RpcService[field]({}, true);

                    if (requestContext.methodName) {
                        rpcMethods.push({
                            aria2MethodName: requestContext.methodName,
                            serviceMethodName: field,
                            fullServiceMethodName: 'aria2RpcService.' + field
                        });
                    }
                } catch (ex) {
                    ariaNgLogService.warn('[AriaNgDebugController.getAria2RPCMethods] failed to execute aria2RpcService method: ' + field, ex);
                }
            }

            return rpcMethods;
        };

        $scope.context = {
            currentTab: 'logs',
            logMaxCount: ariaNgConstants.cachedDebugLogsLimit,
            logAutoRefreshAvailableInterval: ariaNgCommonService.getTimeOptions([100, 200, 500, 1000, 2000], true),
            logAutoRefreshInterval: 1000,
            logListDisplayOrder: 'time:desc',
            logLevelFilter: 'DEBUG',
            logs: [],
            currentLog: null,
            availableRpcMethods: getAria2RPCMethods(),
            rpcRequestMethod: '',
            rpcRequestParameters: '{}',
            rpcResponse: null
        };

        $scope.enableDebugMode = function () {
            return ariaNgSettingService.isEnableDebugMode();
        };

        $scope.changeTab = function (tabName) {
            $scope.context.currentTab = tabName;
        };

        $scope.changeLogListDisplayOrder = function (type) {
            var oldType = ariaNgCommonService.parseOrderType($scope.context.logListDisplayOrder);
            var newType = ariaNgCommonService.parseOrderType(type);

            if (newType.type === oldType.type) {
                newType.reverse = !oldType.reverse;
            }

            $scope.context.logListDisplayOrder = newType.getValue();
        };

        $scope.isLogListSetDisplayOrder = function (type) {
            var orderType = ariaNgCommonService.parseOrderType($scope.context.logListDisplayOrder);
            var targetType = ariaNgCommonService.parseOrderType(type);

            return orderType.equals(targetType);
        };

        $scope.getLogListOrderType = function () {
            return $scope.context.logListDisplayOrder;
        };

        $scope.filterLog = function (log) {
            if (!log || !angular.isString(log.level)) {
                return false;
            }

            if (!$scope.context.logLevelFilter) {
                return true;
            }

            return ariaNgLogService.compareLogLevel(log.level, $scope.context.logLevelFilter) >= 0;
        };

        $scope.setLogLevelFilter = function (filter) {
            $scope.context.logLevelFilter = filter;
        };

        $scope.isSetLogLevelFilter = function (filter) {
            return $scope.context.logLevelFilter === filter;
        };

        $scope.getLogLevelFilter = function () {
            return $scope.context.logLevelFilter;
        };

        $scope.setAutoRefreshInterval = function (interval) {
            $scope.context.logAutoRefreshInterval = interval;

            if (debugLogRefreshPromise) {
                $interval.cancel(debugLogRefreshPromise);
            }

            if (interval > 0) {
                $scope.reloadLogs();

                debugLogRefreshPromise = $interval(function () {
                    $scope.reloadLogs();
                }, $scope.context.logAutoRefreshInterval);
            }
        };

        $scope.reloadLogs = function () {
            $scope.context.logs = ariaNgLogService.getDebugLogs().slice();
        };

        $scope.clearDebugLogs = function () {
            ariaNgCommonService.confirm('Confirm Clear', 'Are you sure you want to clear debug logs?', 'warning', function () {
                ariaNgLogService.clearDebugLogs();
                $scope.reloadLogs();
            }, false);
        };

        $scope.showLogDetail = function (log) {
            $scope.context.currentLog = log;
            angular.element('#log-detail-modal').modal();
        };

        $('#log-detail-modal').on('hide.bs.modal', function (e) {
            $scope.context.currentLog = null;
        });

        $scope.executeAria2Method = function () {
            if (!aria2RpcService[$scope.context.rpcRequestMethod]) {
                ariaNgCommonService.showError('RPC method is illegal!');
                return;
            }

            var context = {
                silent: false,
                callback: function (response) {
                    if (response) {
                        $scope.context.rpcResponse = $filter('json')(response.data);
                    } else {
                        $scope.context.rpcResponse = $filter('json')(response);
                    }
                }
            };

            var parameters = {};

            try {
                parameters = angular.fromJson($scope.context.rpcRequestParameters);
            } catch (ex) {
                ariaNgLogService.error('[AriaNgDebugController.executeAria2Method] failed to parse request parameters: ' + $scope.context.rpcRequestParameters, ex);
                ariaNgCommonService.showError('RPC request parameters are invalid!');
                return;
            }

            for (var key in parameters) {
                if (!parameters.hasOwnProperty(key) || key === 'silent' || key === 'callback') {
                    continue;
                }

                context[key] = parameters[key];
            }

            return aria2RpcService[$scope.context.rpcRequestMethod](context);
        };

        $scope.requestParametersTextboxKeyDown = function (event) {
            if (!ariaNgSettingService.getKeyboardShortcuts()) {
                return;
            }

            if (ariaNgKeyboardService.isCtrlEnterPressed(event) && $scope.executeMethodForm.$valid) {
                if (event.preventDefault) {
                    event.preventDefault();
                }

                $scope.executeAria2Method();

                return false;
            }
        };

        $scope.$on('$destroy', function () {
            if (debugLogRefreshPromise) {
                $interval.cancel(debugLogRefreshPromise);
            }
        });

        $rootScope.swipeActions.extendLeftSwipe = function () {
            var tabItems = getVisibleTabOrders();
            var tabIndex = tabItems.indexOf($scope.context.currentTab);

            if (tabIndex < tabItems.length - 1) {
                $scope.changeTab(tabItems[tabIndex + 1]);
                return true;
            } else {
                return false;
            }
        };

        $rootScope.swipeActions.extendRightSwipe = function () {
            var tabItems = getVisibleTabOrders();
            var tabIndex = tabItems.indexOf($scope.context.currentTab);

            if (tabIndex > 0) {
                $scope.changeTab(tabItems[tabIndex - 1]);
                return true;
            } else {
                return false;
            }
        };

        $rootScope.loadPromise = $timeout(function () {
            if (!ariaNgSettingService.isEnableDebugMode()) {
                ariaNgCommonService.showError('Access Denied!', function () {
                    if (!ariaNgSettingService.isEnableDebugMode()) {
                        $location.path('/settings/ariang');
                    }
                });
                return;
            }

            $scope.setAutoRefreshInterval($scope.context.logAutoRefreshInterval);
        }, 100);
    }]);
}());
