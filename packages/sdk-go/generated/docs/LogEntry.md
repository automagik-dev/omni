# LogEntry

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Time** | **float32** | Timestamp (ms) | 
**Level** | **string** | Log level | 
**Module** | **string** | Module name | 
**Msg** | **string** | Log message | 

## Methods

### NewLogEntry

`func NewLogEntry(time float32, level string, module string, msg string, ) *LogEntry`

NewLogEntry instantiates a new LogEntry object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewLogEntryWithDefaults

`func NewLogEntryWithDefaults() *LogEntry`

NewLogEntryWithDefaults instantiates a new LogEntry object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetTime

`func (o *LogEntry) GetTime() float32`

GetTime returns the Time field if non-nil, zero value otherwise.

### GetTimeOk

`func (o *LogEntry) GetTimeOk() (*float32, bool)`

GetTimeOk returns a tuple with the Time field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTime

`func (o *LogEntry) SetTime(v float32)`

SetTime sets Time field to given value.


### GetLevel

`func (o *LogEntry) GetLevel() string`

GetLevel returns the Level field if non-nil, zero value otherwise.

### GetLevelOk

`func (o *LogEntry) GetLevelOk() (*string, bool)`

GetLevelOk returns a tuple with the Level field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLevel

`func (o *LogEntry) SetLevel(v string)`

SetLevel sets Level field to given value.


### GetModule

`func (o *LogEntry) GetModule() string`

GetModule returns the Module field if non-nil, zero value otherwise.

### GetModuleOk

`func (o *LogEntry) GetModuleOk() (*string, bool)`

GetModuleOk returns a tuple with the Module field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetModule

`func (o *LogEntry) SetModule(v string)`

SetModule sets Module field to given value.


### GetMsg

`func (o *LogEntry) GetMsg() string`

GetMsg returns the Msg field if non-nil, zero value otherwise.

### GetMsgOk

`func (o *LogEntry) GetMsgOk() (*string, bool)`

GetMsgOk returns a tuple with the Msg field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMsg

`func (o *LogEntry) SetMsg(v string)`

SetMsg sets Msg field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


