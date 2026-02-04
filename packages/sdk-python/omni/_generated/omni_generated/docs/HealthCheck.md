# HealthCheck


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**status** | **str** | Check status | 
**latency** | **float** | Latency in milliseconds | [optional] 
**error** | **str** | Error message if status is error | [optional] 
**details** | **Dict[str, Optional[object]]** | Additional details | [optional] 

## Example

```python
from omni_generated.models.health_check import HealthCheck

# TODO update the JSON string below
json = "{}"
# create an instance of HealthCheck from a JSON string
health_check_instance = HealthCheck.from_json(json)
# print the JSON string representation of the object
print(HealthCheck.to_json())

# convert the object into a dict
health_check_dict = health_check_instance.to_dict()
# create an instance of HealthCheck from a dict
health_check_from_dict = HealthCheck.from_dict(health_check_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


