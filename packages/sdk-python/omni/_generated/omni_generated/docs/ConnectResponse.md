# ConnectResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance UUID | 
**status** | **str** | Connection status | 
**message** | **str** | Status message | 

## Example

```python
from omni_generated.models.connect_response import ConnectResponse

# TODO update the JSON string below
json = "{}"
# create an instance of ConnectResponse from a JSON string
connect_response_instance = ConnectResponse.from_json(json)
# print the JSON string representation of the object
print(ConnectResponse.to_json())

# convert the object into a dict
connect_response_dict = connect_response_instance.to_dict()
# create an instance of ConnectResponse from a dict
connect_response_from_dict = ConnectResponse.from_dict(connect_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


