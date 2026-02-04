# InternalHealthResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Status** | **string** | Health status | 
**Service** | **string** | Service name | 
**Pid** | **int32** | Process ID | 
**Memory** | [**GetInternalHealth200ResponseMemory**](GetInternalHealth200ResponseMemory.md) |  | 

## Methods

### NewInternalHealthResponse

`func NewInternalHealthResponse(status string, service string, pid int32, memory GetInternalHealth200ResponseMemory, ) *InternalHealthResponse`

NewInternalHealthResponse instantiates a new InternalHealthResponse object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewInternalHealthResponseWithDefaults

`func NewInternalHealthResponseWithDefaults() *InternalHealthResponse`

NewInternalHealthResponseWithDefaults instantiates a new InternalHealthResponse object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetStatus

`func (o *InternalHealthResponse) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *InternalHealthResponse) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *InternalHealthResponse) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetService

`func (o *InternalHealthResponse) GetService() string`

GetService returns the Service field if non-nil, zero value otherwise.

### GetServiceOk

`func (o *InternalHealthResponse) GetServiceOk() (*string, bool)`

GetServiceOk returns a tuple with the Service field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetService

`func (o *InternalHealthResponse) SetService(v string)`

SetService sets Service field to given value.


### GetPid

`func (o *InternalHealthResponse) GetPid() int32`

GetPid returns the Pid field if non-nil, zero value otherwise.

### GetPidOk

`func (o *InternalHealthResponse) GetPidOk() (*int32, bool)`

GetPidOk returns a tuple with the Pid field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPid

`func (o *InternalHealthResponse) SetPid(v int32)`

SetPid sets Pid field to given value.


### GetMemory

`func (o *InternalHealthResponse) GetMemory() GetInternalHealth200ResponseMemory`

GetMemory returns the Memory field if non-nil, zero value otherwise.

### GetMemoryOk

`func (o *InternalHealthResponse) GetMemoryOk() (*GetInternalHealth200ResponseMemory, bool)`

GetMemoryOk returns a tuple with the Memory field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMemory

`func (o *InternalHealthResponse) SetMemory(v GetInternalHealth200ResponseMemory)`

SetMemory sets Memory field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


