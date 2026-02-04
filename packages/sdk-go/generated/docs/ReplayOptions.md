# ReplayOptions

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Since** | **time.Time** | Start date (required) | 
**Until** | Pointer to **time.Time** | End date | [optional] 
**EventTypes** | Pointer to **[]string** | Event types to replay | [optional] 
**InstanceId** | Pointer to **string** | Filter by instance | [optional] 
**Limit** | Pointer to **int32** | Max events | [optional] 
**SpeedMultiplier** | Pointer to **float32** | Replay speed | [optional] 
**SkipProcessed** | Pointer to **bool** | Skip already processed | [optional] 
**DryRun** | Pointer to **bool** | Dry run mode | [optional] 

## Methods

### NewReplayOptions

`func NewReplayOptions(since time.Time, ) *ReplayOptions`

NewReplayOptions instantiates a new ReplayOptions object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewReplayOptionsWithDefaults

`func NewReplayOptionsWithDefaults() *ReplayOptions`

NewReplayOptionsWithDefaults instantiates a new ReplayOptions object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetSince

`func (o *ReplayOptions) GetSince() time.Time`

GetSince returns the Since field if non-nil, zero value otherwise.

### GetSinceOk

`func (o *ReplayOptions) GetSinceOk() (*time.Time, bool)`

GetSinceOk returns a tuple with the Since field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSince

`func (o *ReplayOptions) SetSince(v time.Time)`

SetSince sets Since field to given value.


### GetUntil

`func (o *ReplayOptions) GetUntil() time.Time`

GetUntil returns the Until field if non-nil, zero value otherwise.

### GetUntilOk

`func (o *ReplayOptions) GetUntilOk() (*time.Time, bool)`

GetUntilOk returns a tuple with the Until field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUntil

`func (o *ReplayOptions) SetUntil(v time.Time)`

SetUntil sets Until field to given value.

### HasUntil

`func (o *ReplayOptions) HasUntil() bool`

HasUntil returns a boolean if a field has been set.

### GetEventTypes

`func (o *ReplayOptions) GetEventTypes() []string`

GetEventTypes returns the EventTypes field if non-nil, zero value otherwise.

### GetEventTypesOk

`func (o *ReplayOptions) GetEventTypesOk() (*[]string, bool)`

GetEventTypesOk returns a tuple with the EventTypes field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventTypes

`func (o *ReplayOptions) SetEventTypes(v []string)`

SetEventTypes sets EventTypes field to given value.

### HasEventTypes

`func (o *ReplayOptions) HasEventTypes() bool`

HasEventTypes returns a boolean if a field has been set.

### GetInstanceId

`func (o *ReplayOptions) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *ReplayOptions) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *ReplayOptions) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.

### HasInstanceId

`func (o *ReplayOptions) HasInstanceId() bool`

HasInstanceId returns a boolean if a field has been set.

### GetLimit

`func (o *ReplayOptions) GetLimit() int32`

GetLimit returns the Limit field if non-nil, zero value otherwise.

### GetLimitOk

`func (o *ReplayOptions) GetLimitOk() (*int32, bool)`

GetLimitOk returns a tuple with the Limit field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLimit

`func (o *ReplayOptions) SetLimit(v int32)`

SetLimit sets Limit field to given value.

### HasLimit

`func (o *ReplayOptions) HasLimit() bool`

HasLimit returns a boolean if a field has been set.

### GetSpeedMultiplier

`func (o *ReplayOptions) GetSpeedMultiplier() float32`

GetSpeedMultiplier returns the SpeedMultiplier field if non-nil, zero value otherwise.

### GetSpeedMultiplierOk

`func (o *ReplayOptions) GetSpeedMultiplierOk() (*float32, bool)`

GetSpeedMultiplierOk returns a tuple with the SpeedMultiplier field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSpeedMultiplier

`func (o *ReplayOptions) SetSpeedMultiplier(v float32)`

SetSpeedMultiplier sets SpeedMultiplier field to given value.

### HasSpeedMultiplier

`func (o *ReplayOptions) HasSpeedMultiplier() bool`

HasSpeedMultiplier returns a boolean if a field has been set.

### GetSkipProcessed

`func (o *ReplayOptions) GetSkipProcessed() bool`

GetSkipProcessed returns the SkipProcessed field if non-nil, zero value otherwise.

### GetSkipProcessedOk

`func (o *ReplayOptions) GetSkipProcessedOk() (*bool, bool)`

GetSkipProcessedOk returns a tuple with the SkipProcessed field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSkipProcessed

`func (o *ReplayOptions) SetSkipProcessed(v bool)`

SetSkipProcessed sets SkipProcessed field to given value.

### HasSkipProcessed

`func (o *ReplayOptions) HasSkipProcessed() bool`

HasSkipProcessed returns a boolean if a field has been set.

### GetDryRun

`func (o *ReplayOptions) GetDryRun() bool`

GetDryRun returns the DryRun field if non-nil, zero value otherwise.

### GetDryRunOk

`func (o *ReplayOptions) GetDryRunOk() (*bool, bool)`

GetDryRunOk returns a tuple with the DryRun field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDryRun

`func (o *ReplayOptions) SetDryRun(v bool)`

SetDryRun sets DryRun field to given value.

### HasDryRun

`func (o *ReplayOptions) HasDryRun() bool`

HasDryRun returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


