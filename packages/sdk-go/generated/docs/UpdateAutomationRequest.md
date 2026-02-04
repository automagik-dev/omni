# UpdateAutomationRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | Pointer to **string** | Name | [optional] 
**Description** | Pointer to **string** | Description | [optional] 
**TriggerEventType** | Pointer to **string** | Trigger event type | [optional] 
**TriggerConditions** | Pointer to [**[]ListAutomations200ResponseItemsInnerTriggerConditionsInner**](ListAutomations200ResponseItemsInnerTriggerConditionsInner.md) | Conditions | [optional] 
**ConditionLogic** | Pointer to **string** | Condition logic: \&quot;and\&quot; (all must match) or \&quot;or\&quot; (any must match) | [optional] [default to "and"]
**Actions** | Pointer to [**[]ListAutomations200ResponseItemsInnerActionsInner**](ListAutomations200ResponseItemsInnerActionsInner.md) | Actions | [optional] 
**Debounce** | Pointer to [**CreateAutomationRequestDebounce**](CreateAutomationRequestDebounce.md) |  | [optional] 
**Enabled** | Pointer to **bool** | Whether enabled | [optional] [default to true]
**Priority** | Pointer to **int32** | Priority | [optional] [default to 0]

## Methods

### NewUpdateAutomationRequest

`func NewUpdateAutomationRequest() *UpdateAutomationRequest`

NewUpdateAutomationRequest instantiates a new UpdateAutomationRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewUpdateAutomationRequestWithDefaults

`func NewUpdateAutomationRequestWithDefaults() *UpdateAutomationRequest`

NewUpdateAutomationRequestWithDefaults instantiates a new UpdateAutomationRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *UpdateAutomationRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *UpdateAutomationRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *UpdateAutomationRequest) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *UpdateAutomationRequest) HasName() bool`

HasName returns a boolean if a field has been set.

### GetDescription

`func (o *UpdateAutomationRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *UpdateAutomationRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *UpdateAutomationRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *UpdateAutomationRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetTriggerEventType

`func (o *UpdateAutomationRequest) GetTriggerEventType() string`

GetTriggerEventType returns the TriggerEventType field if non-nil, zero value otherwise.

### GetTriggerEventTypeOk

`func (o *UpdateAutomationRequest) GetTriggerEventTypeOk() (*string, bool)`

GetTriggerEventTypeOk returns a tuple with the TriggerEventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTriggerEventType

`func (o *UpdateAutomationRequest) SetTriggerEventType(v string)`

SetTriggerEventType sets TriggerEventType field to given value.

### HasTriggerEventType

`func (o *UpdateAutomationRequest) HasTriggerEventType() bool`

HasTriggerEventType returns a boolean if a field has been set.

### GetTriggerConditions

`func (o *UpdateAutomationRequest) GetTriggerConditions() []ListAutomations200ResponseItemsInnerTriggerConditionsInner`

GetTriggerConditions returns the TriggerConditions field if non-nil, zero value otherwise.

### GetTriggerConditionsOk

`func (o *UpdateAutomationRequest) GetTriggerConditionsOk() (*[]ListAutomations200ResponseItemsInnerTriggerConditionsInner, bool)`

GetTriggerConditionsOk returns a tuple with the TriggerConditions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTriggerConditions

`func (o *UpdateAutomationRequest) SetTriggerConditions(v []ListAutomations200ResponseItemsInnerTriggerConditionsInner)`

SetTriggerConditions sets TriggerConditions field to given value.

### HasTriggerConditions

`func (o *UpdateAutomationRequest) HasTriggerConditions() bool`

HasTriggerConditions returns a boolean if a field has been set.

### GetConditionLogic

`func (o *UpdateAutomationRequest) GetConditionLogic() string`

GetConditionLogic returns the ConditionLogic field if non-nil, zero value otherwise.

### GetConditionLogicOk

`func (o *UpdateAutomationRequest) GetConditionLogicOk() (*string, bool)`

GetConditionLogicOk returns a tuple with the ConditionLogic field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConditionLogic

`func (o *UpdateAutomationRequest) SetConditionLogic(v string)`

SetConditionLogic sets ConditionLogic field to given value.

### HasConditionLogic

`func (o *UpdateAutomationRequest) HasConditionLogic() bool`

HasConditionLogic returns a boolean if a field has been set.

### GetActions

`func (o *UpdateAutomationRequest) GetActions() []ListAutomations200ResponseItemsInnerActionsInner`

GetActions returns the Actions field if non-nil, zero value otherwise.

### GetActionsOk

`func (o *UpdateAutomationRequest) GetActionsOk() (*[]ListAutomations200ResponseItemsInnerActionsInner, bool)`

GetActionsOk returns a tuple with the Actions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetActions

`func (o *UpdateAutomationRequest) SetActions(v []ListAutomations200ResponseItemsInnerActionsInner)`

SetActions sets Actions field to given value.

### HasActions

`func (o *UpdateAutomationRequest) HasActions() bool`

HasActions returns a boolean if a field has been set.

### GetDebounce

`func (o *UpdateAutomationRequest) GetDebounce() CreateAutomationRequestDebounce`

GetDebounce returns the Debounce field if non-nil, zero value otherwise.

### GetDebounceOk

`func (o *UpdateAutomationRequest) GetDebounceOk() (*CreateAutomationRequestDebounce, bool)`

GetDebounceOk returns a tuple with the Debounce field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDebounce

`func (o *UpdateAutomationRequest) SetDebounce(v CreateAutomationRequestDebounce)`

SetDebounce sets Debounce field to given value.

### HasDebounce

`func (o *UpdateAutomationRequest) HasDebounce() bool`

HasDebounce returns a boolean if a field has been set.

### GetEnabled

`func (o *UpdateAutomationRequest) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *UpdateAutomationRequest) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *UpdateAutomationRequest) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.

### HasEnabled

`func (o *UpdateAutomationRequest) HasEnabled() bool`

HasEnabled returns a boolean if a field has been set.

### GetPriority

`func (o *UpdateAutomationRequest) GetPriority() int32`

GetPriority returns the Priority field if non-nil, zero value otherwise.

### GetPriorityOk

`func (o *UpdateAutomationRequest) GetPriorityOk() (*int32, bool)`

GetPriorityOk returns a tuple with the Priority field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriority

`func (o *UpdateAutomationRequest) SetPriority(v int32)`

SetPriority sets Priority field to given value.

### HasPriority

`func (o *UpdateAutomationRequest) HasPriority() bool`

HasPriority returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


