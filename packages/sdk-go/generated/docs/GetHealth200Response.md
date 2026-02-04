# GetHealth200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Status** | **string** | Overall health status | 
**Version** | **string** | API version | 
**Uptime** | **int32** | Uptime in seconds | 
**Timestamp** | **time.Time** | Current timestamp | 
**Checks** | [**GetHealth200ResponseChecks**](GetHealth200ResponseChecks.md) |  | 
**Instances** | Pointer to [**GetHealth200ResponseInstances**](GetHealth200ResponseInstances.md) |  | [optional] 

## Methods

### NewGetHealth200Response

`func NewGetHealth200Response(status string, version string, uptime int32, timestamp time.Time, checks GetHealth200ResponseChecks, ) *GetHealth200Response`

NewGetHealth200Response instantiates a new GetHealth200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetHealth200ResponseWithDefaults

`func NewGetHealth200ResponseWithDefaults() *GetHealth200Response`

NewGetHealth200ResponseWithDefaults instantiates a new GetHealth200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetStatus

`func (o *GetHealth200Response) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *GetHealth200Response) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *GetHealth200Response) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetVersion

`func (o *GetHealth200Response) GetVersion() string`

GetVersion returns the Version field if non-nil, zero value otherwise.

### GetVersionOk

`func (o *GetHealth200Response) GetVersionOk() (*string, bool)`

GetVersionOk returns a tuple with the Version field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVersion

`func (o *GetHealth200Response) SetVersion(v string)`

SetVersion sets Version field to given value.


### GetUptime

`func (o *GetHealth200Response) GetUptime() int32`

GetUptime returns the Uptime field if non-nil, zero value otherwise.

### GetUptimeOk

`func (o *GetHealth200Response) GetUptimeOk() (*int32, bool)`

GetUptimeOk returns a tuple with the Uptime field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUptime

`func (o *GetHealth200Response) SetUptime(v int32)`

SetUptime sets Uptime field to given value.


### GetTimestamp

`func (o *GetHealth200Response) GetTimestamp() time.Time`

GetTimestamp returns the Timestamp field if non-nil, zero value otherwise.

### GetTimestampOk

`func (o *GetHealth200Response) GetTimestampOk() (*time.Time, bool)`

GetTimestampOk returns a tuple with the Timestamp field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTimestamp

`func (o *GetHealth200Response) SetTimestamp(v time.Time)`

SetTimestamp sets Timestamp field to given value.


### GetChecks

`func (o *GetHealth200Response) GetChecks() GetHealth200ResponseChecks`

GetChecks returns the Checks field if non-nil, zero value otherwise.

### GetChecksOk

`func (o *GetHealth200Response) GetChecksOk() (*GetHealth200ResponseChecks, bool)`

GetChecksOk returns a tuple with the Checks field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChecks

`func (o *GetHealth200Response) SetChecks(v GetHealth200ResponseChecks)`

SetChecks sets Checks field to given value.


### GetInstances

`func (o *GetHealth200Response) GetInstances() GetHealth200ResponseInstances`

GetInstances returns the Instances field if non-nil, zero value otherwise.

### GetInstancesOk

`func (o *GetHealth200Response) GetInstancesOk() (*GetHealth200ResponseInstances, bool)`

GetInstancesOk returns a tuple with the Instances field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstances

`func (o *GetHealth200Response) SetInstances(v GetHealth200ResponseInstances)`

SetInstances sets Instances field to given value.

### HasInstances

`func (o *GetHealth200Response) HasInstances() bool`

HasInstances returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


