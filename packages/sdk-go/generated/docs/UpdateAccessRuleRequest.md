# UpdateAccessRuleRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**InstanceId** | Pointer to **NullableString** | Instance ID (null for global) | [optional] 
**RuleType** | Pointer to **string** | Rule type | [optional] 
**PhonePattern** | Pointer to **string** | Phone pattern with wildcards | [optional] 
**PlatformUserId** | Pointer to **string** | Exact platform user ID | [optional] 
**PersonId** | Pointer to **string** | Person ID | [optional] 
**Priority** | Pointer to **int32** | Priority | [optional] [default to 0]
**Enabled** | Pointer to **bool** | Whether enabled | [optional] [default to true]
**Reason** | Pointer to **string** | Reason | [optional] 
**ExpiresAt** | Pointer to **time.Time** | Expiration | [optional] 
**Action** | Pointer to **string** | Action | [optional] [default to "block"]
**BlockMessage** | Pointer to **string** | Custom block message | [optional] 

## Methods

### NewUpdateAccessRuleRequest

`func NewUpdateAccessRuleRequest() *UpdateAccessRuleRequest`

NewUpdateAccessRuleRequest instantiates a new UpdateAccessRuleRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewUpdateAccessRuleRequestWithDefaults

`func NewUpdateAccessRuleRequestWithDefaults() *UpdateAccessRuleRequest`

NewUpdateAccessRuleRequestWithDefaults instantiates a new UpdateAccessRuleRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *UpdateAccessRuleRequest) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *UpdateAccessRuleRequest) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *UpdateAccessRuleRequest) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.

### HasInstanceId

`func (o *UpdateAccessRuleRequest) HasInstanceId() bool`

HasInstanceId returns a boolean if a field has been set.

### SetInstanceIdNil

`func (o *UpdateAccessRuleRequest) SetInstanceIdNil(b bool)`

 SetInstanceIdNil sets the value for InstanceId to be an explicit nil

### UnsetInstanceId
`func (o *UpdateAccessRuleRequest) UnsetInstanceId()`

UnsetInstanceId ensures that no value is present for InstanceId, not even an explicit nil
### GetRuleType

`func (o *UpdateAccessRuleRequest) GetRuleType() string`

GetRuleType returns the RuleType field if non-nil, zero value otherwise.

### GetRuleTypeOk

`func (o *UpdateAccessRuleRequest) GetRuleTypeOk() (*string, bool)`

GetRuleTypeOk returns a tuple with the RuleType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRuleType

`func (o *UpdateAccessRuleRequest) SetRuleType(v string)`

SetRuleType sets RuleType field to given value.

### HasRuleType

`func (o *UpdateAccessRuleRequest) HasRuleType() bool`

HasRuleType returns a boolean if a field has been set.

### GetPhonePattern

`func (o *UpdateAccessRuleRequest) GetPhonePattern() string`

GetPhonePattern returns the PhonePattern field if non-nil, zero value otherwise.

### GetPhonePatternOk

`func (o *UpdateAccessRuleRequest) GetPhonePatternOk() (*string, bool)`

GetPhonePatternOk returns a tuple with the PhonePattern field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPhonePattern

`func (o *UpdateAccessRuleRequest) SetPhonePattern(v string)`

SetPhonePattern sets PhonePattern field to given value.

### HasPhonePattern

`func (o *UpdateAccessRuleRequest) HasPhonePattern() bool`

HasPhonePattern returns a boolean if a field has been set.

### GetPlatformUserId

`func (o *UpdateAccessRuleRequest) GetPlatformUserId() string`

GetPlatformUserId returns the PlatformUserId field if non-nil, zero value otherwise.

### GetPlatformUserIdOk

`func (o *UpdateAccessRuleRequest) GetPlatformUserIdOk() (*string, bool)`

GetPlatformUserIdOk returns a tuple with the PlatformUserId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformUserId

`func (o *UpdateAccessRuleRequest) SetPlatformUserId(v string)`

SetPlatformUserId sets PlatformUserId field to given value.

### HasPlatformUserId

`func (o *UpdateAccessRuleRequest) HasPlatformUserId() bool`

HasPlatformUserId returns a boolean if a field has been set.

### GetPersonId

`func (o *UpdateAccessRuleRequest) GetPersonId() string`

GetPersonId returns the PersonId field if non-nil, zero value otherwise.

### GetPersonIdOk

`func (o *UpdateAccessRuleRequest) GetPersonIdOk() (*string, bool)`

GetPersonIdOk returns a tuple with the PersonId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPersonId

`func (o *UpdateAccessRuleRequest) SetPersonId(v string)`

SetPersonId sets PersonId field to given value.

### HasPersonId

`func (o *UpdateAccessRuleRequest) HasPersonId() bool`

HasPersonId returns a boolean if a field has been set.

### GetPriority

`func (o *UpdateAccessRuleRequest) GetPriority() int32`

GetPriority returns the Priority field if non-nil, zero value otherwise.

### GetPriorityOk

`func (o *UpdateAccessRuleRequest) GetPriorityOk() (*int32, bool)`

GetPriorityOk returns a tuple with the Priority field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriority

`func (o *UpdateAccessRuleRequest) SetPriority(v int32)`

SetPriority sets Priority field to given value.

### HasPriority

`func (o *UpdateAccessRuleRequest) HasPriority() bool`

HasPriority returns a boolean if a field has been set.

### GetEnabled

`func (o *UpdateAccessRuleRequest) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *UpdateAccessRuleRequest) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *UpdateAccessRuleRequest) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.

### HasEnabled

`func (o *UpdateAccessRuleRequest) HasEnabled() bool`

HasEnabled returns a boolean if a field has been set.

### GetReason

`func (o *UpdateAccessRuleRequest) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *UpdateAccessRuleRequest) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *UpdateAccessRuleRequest) SetReason(v string)`

SetReason sets Reason field to given value.

### HasReason

`func (o *UpdateAccessRuleRequest) HasReason() bool`

HasReason returns a boolean if a field has been set.

### GetExpiresAt

`func (o *UpdateAccessRuleRequest) GetExpiresAt() time.Time`

GetExpiresAt returns the ExpiresAt field if non-nil, zero value otherwise.

### GetExpiresAtOk

`func (o *UpdateAccessRuleRequest) GetExpiresAtOk() (*time.Time, bool)`

GetExpiresAtOk returns a tuple with the ExpiresAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpiresAt

`func (o *UpdateAccessRuleRequest) SetExpiresAt(v time.Time)`

SetExpiresAt sets ExpiresAt field to given value.

### HasExpiresAt

`func (o *UpdateAccessRuleRequest) HasExpiresAt() bool`

HasExpiresAt returns a boolean if a field has been set.

### GetAction

`func (o *UpdateAccessRuleRequest) GetAction() string`

GetAction returns the Action field if non-nil, zero value otherwise.

### GetActionOk

`func (o *UpdateAccessRuleRequest) GetActionOk() (*string, bool)`

GetActionOk returns a tuple with the Action field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAction

`func (o *UpdateAccessRuleRequest) SetAction(v string)`

SetAction sets Action field to given value.

### HasAction

`func (o *UpdateAccessRuleRequest) HasAction() bool`

HasAction returns a boolean if a field has been set.

### GetBlockMessage

`func (o *UpdateAccessRuleRequest) GetBlockMessage() string`

GetBlockMessage returns the BlockMessage field if non-nil, zero value otherwise.

### GetBlockMessageOk

`func (o *UpdateAccessRuleRequest) GetBlockMessageOk() (*string, bool)`

GetBlockMessageOk returns a tuple with the BlockMessage field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBlockMessage

`func (o *UpdateAccessRuleRequest) SetBlockMessage(v string)`

SetBlockMessage sets BlockMessage field to given value.

### HasBlockMessage

`func (o *UpdateAccessRuleRequest) HasBlockMessage() bool`

HasBlockMessage returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


